import { isMedimadeSessionActive } from "@/lib/auth-session";

/**
 * Meaningful quotes for Ideate home — lines that keep you oriented.
 * Signed-in: in-memory + cloud PUT. Guests: device localStorage.
 */

export type IdeateQuote = {
  id: string;
  text: string;
  attribution?: string;
  createdAt: string;
  updatedAt: string;
};

export type IdeateQuotesStoreV1 = {
  v: 1;
  quotes: IdeateQuote[];
};

const LS_KEY = "mm_ideate_quotes_v1";
const MAX_QUOTES = 40;
const MAX_TEXT = 400;
const MAX_ATTRIBUTION = 80;

let memoryStore: IdeateQuotesStoreV1 | null = null;

function emptyQuotes(): IdeateQuotesStoreV1 {
  return { v: 1, quotes: [] };
}

function isSignedIn(): boolean {
  return isMedimadeSessionActive();
}

function removeQuotesLs(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {
    /* */
  }
}

export function clearIdeateQuotesDeviceData(): void {
  memoryStore = null;
  removeQuotesLs();
}

export function clearIdeateQuotesMemoryOnly(): void {
  memoryStore = null;
}

function safeIso(): string {
  try {
    return new Date().toISOString();
  } catch {
    return "1970-01-01T00:00:00.000Z";
  }
}

function newId(prefix: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return `${prefix}_${(crypto as any).randomUUID()}`;
  }
  return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function normalizeQuote(x: unknown): IdeateQuote | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.text !== "string") return null;
  const text = o.text.trim().slice(0, MAX_TEXT);
  if (!text) return null;
  const createdAt = typeof o.createdAt === "string" ? o.createdAt : safeIso();
  const attributionRaw =
    typeof o.attribution === "string"
      ? o.attribution.trim().slice(0, MAX_ATTRIBUTION)
      : "";
  return {
    id: o.id,
    text,
    ...(attributionRaw ? { attribution: attributionRaw } : {}),
    createdAt,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : createdAt,
  };
}

export function loadIdeateQuotesStore(): IdeateQuotesStoreV1 {
  if (typeof window === "undefined") return emptyQuotes();
  if (isSignedIn()) {
    return memoryStore ? structuredClone(memoryStore) : emptyQuotes();
  }
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return emptyQuotes();
    const parsed = JSON.parse(raw) as { v?: number; quotes?: unknown[] };
    if (parsed?.v !== 1 || !Array.isArray(parsed.quotes)) {
      return emptyQuotes();
    }
    return {
      v: 1,
      quotes: parsed.quotes
        .map(normalizeQuote)
        .filter((q): q is IdeateQuote => Boolean(q))
        .slice(0, MAX_QUOTES),
    };
  } catch {
    return emptyQuotes();
  }
}

export function saveIdeateQuotesStoreLocal(store: IdeateQuotesStoreV1) {
  if (typeof window === "undefined") return;
  const normalized: IdeateQuotesStoreV1 = {
    v: 1,
    quotes: store.quotes
      .map(normalizeQuote)
      .filter((q): q is IdeateQuote => Boolean(q))
      .slice(0, MAX_QUOTES),
  };
  if (isSignedIn()) {
    memoryStore = structuredClone(normalized);
    removeQuotesLs();
    return;
  }
  memoryStore = null;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(normalized));
  } catch {
    /* */
  }
}

export function saveIdeateQuotesStore(store: IdeateQuotesStoreV1) {
  saveIdeateQuotesStoreLocal(store);
  if (isSignedIn()) {
    void import("@/lib/ideate-cloud").then((m) => m.scheduleIdeateCloudPush());
  }
}

export function addIdeateQuote(
  store: IdeateQuotesStoreV1,
  input: { text: string; attribution?: string },
): IdeateQuotesStoreV1 {
  const text = input.text.trim().slice(0, MAX_TEXT);
  if (!text) return store;
  if (store.quotes.length >= MAX_QUOTES) return store;
  const now = safeIso();
  const attribution = (input.attribution ?? "").trim().slice(0, MAX_ATTRIBUTION);
  const next: IdeateQuote = {
    id: newId("quote"),
    text,
    ...(attribution ? { attribution } : {}),
    createdAt: now,
    updatedAt: now,
  };
  return { v: 1, quotes: [next, ...store.quotes] };
}

/** Add several quotes (newest first), skipping blanks / capacity. */
export function addIdeateQuotes(
  store: IdeateQuotesStoreV1,
  inputs: Array<{ text: string; attribution?: string }>,
): IdeateQuotesStoreV1 {
  let next = store;
  // Preserve input order in the list by inserting oldest-first into the prepend path.
  for (let i = inputs.length - 1; i >= 0; i--) {
    const item = inputs[i]!;
    next = addIdeateQuote(next, item);
  }
  return next;
}

export function patchIdeateQuote(
  store: IdeateQuotesStoreV1,
  id: string,
  input: { text: string; attribution?: string | null },
): IdeateQuotesStoreV1 {
  const text = input.text.trim().slice(0, MAX_TEXT);
  if (!text) return store;
  return {
    v: 1,
    quotes: store.quotes.map((q) => {
      if (q.id !== id) return q;
      const attribution =
        input.attribution === null
          ? undefined
          : input.attribution !== undefined
            ? input.attribution.trim().slice(0, MAX_ATTRIBUTION) || undefined
            : q.attribution;
      return {
        ...q,
        text,
        ...(attribution ? { attribution } : { attribution: undefined }),
        updatedAt: safeIso(),
      };
    }),
  };
}

export function removeIdeateQuote(
  store: IdeateQuotesStoreV1,
  id: string,
): IdeateQuotesStoreV1 {
  return { v: 1, quotes: store.quotes.filter((q) => q.id !== id) };
}

export function isDemoQuote(q: IdeateQuote): boolean {
  return q.id.startsWith("demo-quote-");
}
