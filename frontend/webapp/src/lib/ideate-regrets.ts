import { isMedimadeSessionActive } from "@/lib/auth-session";

/**
 * Regret-minimisation entries for Ideate home ("80-year-old test").
 * Signed-in: in-memory + cloud PUT. Guests: device localStorage.
 */

export type IdeateRegret = {
  id: string;
  statement: string;
  category?: string;
  createdAt: string;
  updatedAt: string;
};

export type IdeateRegretsStoreV1 = {
  v: 1;
  regrets: IdeateRegret[];
};

const LS_KEY = "mm_ideate_regrets_v1";
const MAX_REGRETS = 40;
const MAX_STATEMENT = 280;
const MAX_CATEGORY = 40;

let memoryStore: IdeateRegretsStoreV1 | null = null;

function emptyRegrets(): IdeateRegretsStoreV1 {
  return { v: 1, regrets: [] };
}

function isSignedIn(): boolean {
  return isMedimadeSessionActive();
}

function removeRegretsLs(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {
    /* */
  }
}

export function clearIdeateRegretsDeviceData(): void {
  memoryStore = null;
  removeRegretsLs();
}

export function clearIdeateRegretsMemoryOnly(): void {
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

function normalizeRegret(x: unknown): IdeateRegret | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.statement !== "string") return null;
  const statement = o.statement.trim().slice(0, MAX_STATEMENT);
  if (!statement) return null;
  const createdAt = typeof o.createdAt === "string" ? o.createdAt : safeIso();
  const categoryRaw =
    typeof o.category === "string" ? o.category.trim().slice(0, MAX_CATEGORY) : "";
  return {
    id: o.id,
    statement,
    ...(categoryRaw ? { category: categoryRaw } : {}),
    createdAt,
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : createdAt,
  };
}

export function loadIdeateRegretsStore(): IdeateRegretsStoreV1 {
  if (typeof window === "undefined") return emptyRegrets();
  if (isSignedIn()) {
    return memoryStore ? structuredClone(memoryStore) : emptyRegrets();
  }
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return emptyRegrets();
    const parsed = JSON.parse(raw) as { v?: number; regrets?: unknown[] };
    if (parsed?.v !== 1 || !Array.isArray(parsed.regrets)) {
      return emptyRegrets();
    }
    return {
      v: 1,
      regrets: parsed.regrets
        .map(normalizeRegret)
        .filter((r): r is IdeateRegret => Boolean(r))
        .slice(0, MAX_REGRETS),
    };
  } catch {
    return emptyRegrets();
  }
}

export function saveIdeateRegretsStoreLocal(store: IdeateRegretsStoreV1) {
  if (typeof window === "undefined") return;
  const normalized: IdeateRegretsStoreV1 = {
    v: 1,
    regrets: store.regrets
      .map(normalizeRegret)
      .filter((r): r is IdeateRegret => Boolean(r))
      .slice(0, MAX_REGRETS),
  };
  if (isSignedIn()) {
    memoryStore = structuredClone(normalized);
    removeRegretsLs();
    return;
  }
  memoryStore = null;
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(normalized));
  } catch {
    /* */
  }
}

export function saveIdeateRegretsStore(store: IdeateRegretsStoreV1) {
  saveIdeateRegretsStoreLocal(store);
  if (isSignedIn()) {
    void import("@/lib/ideate-cloud").then((m) => m.scheduleIdeateCloudPush());
  }
}

export function addIdeateRegret(
  store: IdeateRegretsStoreV1,
  input: { statement: string; category?: string },
): IdeateRegretsStoreV1 {
  const statement = input.statement.trim().slice(0, MAX_STATEMENT);
  if (!statement) return store;
  if (store.regrets.length >= MAX_REGRETS) return store;
  const now = safeIso();
  const category = (input.category ?? "").trim().slice(0, MAX_CATEGORY);
  const next: IdeateRegret = {
    id: newId("regret"),
    statement,
    ...(category ? { category } : {}),
    createdAt: now,
    updatedAt: now,
  };
  return { v: 1, regrets: [...store.regrets, next] };
}

export function patchIdeateRegret(
  store: IdeateRegretsStoreV1,
  id: string,
  input: { statement: string; category?: string | null },
): IdeateRegretsStoreV1 {
  const statement = input.statement.trim().slice(0, MAX_STATEMENT);
  if (!statement) return store;
  return {
    v: 1,
    regrets: store.regrets.map((r) => {
      if (r.id !== id) return r;
      const category =
        input.category === null
          ? undefined
          : input.category !== undefined
            ? input.category.trim().slice(0, MAX_CATEGORY) || undefined
            : r.category;
      return {
        ...r,
        statement,
        ...(category ? { category } : { category: undefined }),
        updatedAt: safeIso(),
      };
    }),
  };
}

export function removeIdeateRegret(
  store: IdeateRegretsStoreV1,
  id: string,
): IdeateRegretsStoreV1 {
  return { v: 1, regrets: store.regrets.filter((r) => r.id !== id) };
}

export function isDemoRegret(r: IdeateRegret): boolean {
  return r.id.startsWith("demo-regret-");
}
