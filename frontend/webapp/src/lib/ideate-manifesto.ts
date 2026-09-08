/**
 * One-sentence Dream manifesto distilled from values (+ life area titles).
 * Cached on device by fingerprint; regenerated via Haiku when inputs change.
 */

import { CLAUDE_HAIKU_45_MODEL_ID } from "@/lib/claude-pricing";
import { streamMedimadeChat } from "@/lib/medimade-api";

const LS_KEY = "mm_ideate_manifesto_v1";
const MAX_WORDS = 25;

export type IdeateManifestoCacheV1 = {
  v: 1;
  fingerprint: string;
  text: string;
  updatedAt: string;
};

export function manifestoFingerprint(
  values: string[],
  lifeAreaTitles: string[],
): string {
  const v = values
    .map((t) => t.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  const a = lifeAreaTitles
    .map((t) => t.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
  return JSON.stringify({ v, a });
}

function readCache(): IdeateManifestoCacheV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as IdeateManifestoCacheV1;
    if (
      parsed?.v !== 1 ||
      typeof parsed.fingerprint !== "string" ||
      typeof parsed.text !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(next: IdeateManifestoCacheV1): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch {
    /* */
  }
}

export function clearIdeateManifestoCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {
    /* */
  }
}

export function loadCachedManifesto(fingerprint: string): string | null {
  const cached = readCache();
  if (!cached || cached.fingerprint !== fingerprint) return null;
  const text = sanitizeManifesto(cached.text);
  return text || null;
}

function clipWords(text: string, maxWords: number): string {
  const words = text.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ").replace(/[.,;:!?]*$/, "")}.`;
}

/** Strip quotes / markdown italic markers models sometimes wrap around the sentence. */
function sanitizeManifesto(text: string): string {
  let t = text.trim().replace(/\s+/g, " ");
  t = t.replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
  // *sentence* or **sentence**
  t = t.replace(/^\*{1,2}\s*([\s\S]*?)\s*\*{1,2}$/u, "$1").trim();
  // _sentence_
  t = t.replace(/^_\s*([\s\S]*?)\s*_$/u, "$1").trim();
  // Leftover edge asterisks
  t = t.replace(/^\*+\s*|\s*\*+$/g, "").trim();
  return t;
}

function localFallback(values: string[]): string {
  const list = values.map((t) => t.trim()).filter(Boolean);
  if (list.length === 0) return "";
  if (list.length === 1) {
    return `I stand for ${list[0]!.toLowerCase()}.`;
  }
  if (list.length === 2) {
    return `I stand for ${list[0]!.toLowerCase()} and ${list[1]!.toLowerCase()}.`;
  }
  const head = list.slice(0, -1).map((t) => t.toLowerCase());
  const last = list[list.length - 1]!.toLowerCase();
  return `I stand for ${head.join(", ")}, and ${last}.`;
}

function buildPrompt(values: string[], lifeAreaTitles: string[]): string {
  const valueList = values.map((t) => t.trim()).filter(Boolean).join("; ");
  const areas = lifeAreaTitles.map((t) => t.trim()).filter(Boolean);
  const areasLine =
    areas.length > 0
      ? ` Their life areas include: ${areas.join("; ")}.`
      : "";
  return (
    `These are the user's personal values: ${valueList}.${areasLine} ` +
    `Write a single sentence (max ${MAX_WORDS} words) that distils what they stand for into a personal statement. ` +
    `First person. Specific to their actual values, not generic. Write something worth reading in italic. ` +
    `Reply with only the sentence — no quotes, no markdown, no asterisks, no preamble.`
  );
}

/**
 * Return cached manifesto or generate (Haiku). Falls back to a local sentence if the
 * chat call fails (e.g. guest / offline).
 * Pass `force: true` to bypass cache and regenerate.
 */
export async function ensureIdeateManifesto(opts: {
  values: string[];
  lifeAreaTitles: string[];
  force?: boolean;
}): Promise<string> {
  const values = opts.values.map((t) => t.trim()).filter(Boolean);
  if (values.length === 0) return "";

  const fingerprint = manifestoFingerprint(values, opts.lifeAreaTitles);
  if (!opts.force) {
    const cached = loadCachedManifesto(fingerprint);
    if (cached) return cached;
  }

  let text = "";
  try {
    text = await streamMedimadeChat(
      {
        meditationStyle: "General",
        journalMode: true,
        claudeModel: CLAUDE_HAIKU_45_MODEL_ID,
        messages: [{ role: "user", content: buildPrompt(values, opts.lifeAreaTitles) }],
      },
      () => {
        /* ignore stream deltas — we only need the final sentence */
      },
    );
  } catch {
    text = "";
  }

  text = clipWords(
    sanitizeManifesto(text || localFallback(values)),
    MAX_WORDS,
  );
  if (!text) text = localFallback(values);

  writeCache({
    v: 1,
    fingerprint,
    text,
    updatedAt: new Date().toISOString(),
  });
  return text;
}

/** Persist a manually edited manifesto for the current values fingerprint. */
export function saveIdeateManifestoManual(opts: {
  values: string[];
  lifeAreaTitles: string[];
  text: string;
}): string {
  const values = opts.values.map((t) => t.trim()).filter(Boolean);
  const fingerprint = manifestoFingerprint(values, opts.lifeAreaTitles);
  const text = clipWords(sanitizeManifesto(opts.text), MAX_WORDS);
  if (!text) return loadCachedManifesto(fingerprint) ?? "";
  writeCache({
    v: 1,
    fingerprint,
    text,
    updatedAt: new Date().toISOString(),
  });
  return text;
}
