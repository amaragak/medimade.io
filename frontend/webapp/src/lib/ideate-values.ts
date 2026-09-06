import { getMedimadeSessionJwt } from "@/lib/auth-session";

/**
 * Per-user Ideate values — discrete items, not a single freeform field.
 * Signed-in: in-memory + cloud PUT (never localStorage). Guests: device only.
 */

export type IdeateValue = {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
};

export type IdeateValuesStoreV1 = {
  v: 1;
  values: IdeateValue[];
};

const LS_KEY = "mm_ideate_values_v1";
const MAX_VALUES = 40;
const MAX_TEXT = 120;

/** Signed-in session copy — never written to localStorage. */
let memoryStore: IdeateValuesStoreV1 | null = null;

function emptyValues(): IdeateValuesStoreV1 {
  return { v: 1, values: [] };
}

function isSignedIn(): boolean {
  return Boolean(getMedimadeSessionJwt());
}

function removeValuesLs(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {
    /* */
  }
}

/** Drop signed-in memory + any leftover localStorage values. */
export function clearIdeateValuesDeviceData(): void {
  memoryStore = null;
  removeValuesLs();
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

function normalizeValue(x: unknown): IdeateValue | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.text !== "string") return null;
  const text = o.text.trim().slice(0, MAX_TEXT);
  if (!text) return null;
  const createdAt = typeof o.createdAt === "string" ? o.createdAt : safeIso();
  return {
    id: o.id,
    text,
    createdAt,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : createdAt,
  };
}

export function loadIdeateValuesStore(): IdeateValuesStoreV1 {
  if (typeof window === "undefined") return emptyValues();
  if (isSignedIn()) {
    return memoryStore ? structuredClone(memoryStore) : emptyValues();
  }
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return emptyValues();
    const parsed = JSON.parse(raw) as { v?: number; values?: unknown[] };
    if (parsed?.v !== 1 || !Array.isArray(parsed.values)) {
      return emptyValues();
    }
    return {
      v: 1,
      values: parsed.values
        .map(normalizeValue)
        .filter((v): v is IdeateValue => Boolean(v))
        .slice(0, MAX_VALUES),
    };
  } catch {
    return emptyValues();
  }
}

/**
 * Persist working copy: memory only when signed in (never localStorage);
 * guests use localStorage.
 */
export function saveIdeateValuesStoreLocal(store: IdeateValuesStoreV1) {
  if (typeof window === "undefined") return;
  const normalized: IdeateValuesStoreV1 = {
    v: 1,
    values: store.values
      .map(normalizeValue)
      .filter((v): v is IdeateValue => Boolean(v))
      .slice(0, MAX_VALUES),
  };
  if (isSignedIn()) {
    memoryStore = structuredClone(normalized);
    removeValuesLs();
    return;
  }
  memoryStore = null;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(normalized));
  } catch {
    /* ignore */
  }
}

/** Persist and schedule cloud PUT when signed in. */
export function saveIdeateValuesStore(store: IdeateValuesStoreV1) {
  saveIdeateValuesStoreLocal(store);
  if (isSignedIn()) {
    void import("@/lib/ideate-cloud").then((m) => m.scheduleIdeateCloudPush());
  }
}

export function addIdeateValue(
  store: IdeateValuesStoreV1,
  text: string,
): IdeateValuesStoreV1 {
  const trimmed = text.trim().slice(0, MAX_TEXT);
  if (!trimmed) return store;
  if (store.values.length >= MAX_VALUES) return store;
  const now = safeIso();
  const next: IdeateValue = {
    id: newId("val"),
    text: trimmed,
    createdAt: now,
    updatedAt: now,
  };
  return { v: 1, values: [...store.values, next] };
}

export function patchIdeateValue(
  store: IdeateValuesStoreV1,
  id: string,
  text: string,
): IdeateValuesStoreV1 {
  const trimmed = text.trim().slice(0, MAX_TEXT);
  if (!trimmed) return store;
  return {
    v: 1,
    values: store.values.map((v) =>
      v.id === id ? { ...v, text: trimmed, updatedAt: safeIso() } : v,
    ),
  };
}

export function removeIdeateValue(
  store: IdeateValuesStoreV1,
  id: string,
): IdeateValuesStoreV1 {
  return {
    v: 1,
    values: store.values.filter((v) => v.id !== id),
  };
}
