/**
 * Ideate manifesto — one sentence. Persisted; only changes on edit or regenerate.
 * Signed-in: in-memory + cloud bundle. Guests: device localStorage.
 */

import { isMedimadeSessionActive } from "@/lib/auth-session";
import { CLAUDE_HAIKU_45_MODEL_ID } from "@/lib/claude-pricing";
import { streamMedimadeChat } from "@/lib/medimade-api";

const LS_KEY = "mm_ideate_manifesto_v1";
const MAX_WORDS = 25;

export type IdeateManifestoStoreV1 = {
  v: 1;
  text: string;
  updatedAt: string;
};

/** @deprecated shape — migrated on read */
type LegacyManifestoCacheV1 = {
  v: 1;
  fingerprint?: string;
  text: string;
  updatedAt: string;
};

let memoryStore: IdeateManifestoStoreV1 | null = null;

function isSignedIn(): boolean {
  return isMedimadeSessionActive();
}

function safeIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return "1970-01-01T00:00:00.000Z";
  }
}

function emptyStore(): IdeateManifestoStoreV1 {
  return { v: 1, text: "", updatedAt: safeIso() };
}

function normalizeStore(x: unknown): IdeateManifestoStoreV1 | null {
  if (!x || typeof x !== "object") return null;
  const o = x as LegacyManifestoCacheV1;
  if (o.v !== 1 || typeof o.text !== "string") return null;
  const text = sanitizeManifesto(o.text);
  return {
    v: 1,
    text,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : safeIso(),
  };
}

function removeManifestoLs(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {
    /* */
  }
}

export function clearIdeateManifestoDeviceData(): void {
  memoryStore = null;
  removeManifestoLs();
}

export function clearIdeateManifestoMemoryOnly(): void {
  memoryStore = null;
}

/** @deprecated — use clearIdeateManifestoDeviceData */
export function clearIdeateManifestoCache(): void {
  clearIdeateManifestoDeviceData();
}

export function loadIdeateManifestoStore(): IdeateManifestoStoreV1 {
  if (typeof window === "undefined") return emptyStore();
  if (isSignedIn()) {
    return memoryStore ? structuredClone(memoryStore) : emptyStore();
  }
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return emptyStore();
    const parsed = normalizeStore(JSON.parse(raw) as unknown);
    return parsed ?? emptyStore();
  } catch {
    return emptyStore();
  }
}

export function saveIdeateManifestoStoreLocal(store: IdeateManifestoStoreV1) {
  if (typeof window === "undefined") return;
  const normalized = normalizeStore(store) ?? emptyStore();
  if (isSignedIn()) {
    memoryStore = structuredClone(normalized);
    removeManifestoLs();
    return;
  }
  memoryStore = null;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(normalized));
  } catch {
    /* */
  }
}

export function saveIdeateManifestoStore(store: IdeateManifestoStoreV1) {
  saveIdeateManifestoStoreLocal(store);
  if (isSignedIn()) {
    void import("@/lib/ideate-cloud").then((m) => m.scheduleIdeateCloudPush());
  }
}

/** Any stored text, regardless of values fingerprint. */
export function loadStoredManifesto(): string | null {
  const text = loadIdeateManifestoStore().text.trim();
  return text || null;
}

/** @deprecated fingerprint gate — prefer loadStoredManifesto */
export function loadCachedManifesto(_fingerprint?: string): string | null {
  return loadStoredManifesto();
}

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

function clipWords(text: string, maxWords: number): string {
  const words = text.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ").replace(/[.,;:!?]*$/, "")}.`;
}

/** Strip quotes / markdown italic markers models sometimes wrap around the sentence. */
export function sanitizeManifesto(text: string): string {
  let t = text.trim().replace(/\s+/g, " ");
  t = t.replace(/^["“”'`]+|["“”'`]+$/g, "").trim();
  t = t.replace(/^\*{1,2}\s*([\s\S]*?)\s*\*{1,2}$/u, "$1").trim();
  t = t.replace(/^_\s*([\s\S]*?)\s*_$/u, "$1").trim();
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

function persistText(text: string): string {
  const cleaned = clipWords(sanitizeManifesto(text), MAX_WORDS);
  if (!cleaned) return loadStoredManifesto() ?? "";
  saveIdeateManifestoStore({
    v: 1,
    text: cleaned,
    updatedAt: safeIso(),
  });
  return cleaned;
}

/**
 * Return stored manifesto, or generate once when none exists.
 * Pass `force: true` only for explicit regenerate.
 */
export async function ensureIdeateManifesto(opts: {
  values: string[];
  lifeAreaTitles: string[];
  force?: boolean;
}): Promise<string> {
  const values = opts.values.map((t) => t.trim()).filter(Boolean);
  if (values.length === 0) return "";

  if (!opts.force) {
    const cached = loadStoredManifesto();
    if (cached) return cached;
  }

  let text = "";
  try {
    text = await streamMedimadeChat(
      {
        meditationStyle: "General",
        journalMode: true,
        claudeModel: CLAUDE_HAIKU_45_MODEL_ID,
        messages: [
          { role: "user", content: buildPrompt(values, opts.lifeAreaTitles) },
        ],
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
  return persistText(text);
}

/** Persist a manually edited manifesto. */
export function saveIdeateManifestoManual(opts: {
  values: string[];
  lifeAreaTitles: string[];
  text: string;
}): string {
  const values = opts.values.map((t) => t.trim()).filter(Boolean);
  if (values.length === 0) return "";
  return persistText(opts.text);
}
