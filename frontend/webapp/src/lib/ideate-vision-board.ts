/**
 * Ideate vision board metadata.
 * Signed-in: in-memory working copy + cloud PUT (never localStorage).
 * Guests: device-only metadata + IndexedDB binaries.
 */

import { getMedimadeSessionJwt } from "@/lib/auth-session";

export type VisionBoardVersion = {
  id: string;
  prompt: string;
  imageUrl?: string;
  mediaId?: string;
  mediaKey?: string;
  /** User refine note that produced this version (absent on the first generate). */
  changeRequest?: string;
  createdAt: string;
};

export type VisionBoardItem = {
  id: string;
  /** Soft fill for the preview mosaic (and fallback when no image). */
  color: string;
  label: string;
  kind?: "swatch" | "image";
  /** Guest-only IndexedDB media id — never written to cloud. */
  mediaId?: string;
  /** CloudFront URL (source of truth when signed in). */
  imageUrl?: string;
  mediaKey?: string;
  /** Scene prompt for the active (visible) image. */
  prompt?: string;
  /** Refine note that produced the active image (if refined). */
  changeRequest?: string;
  createdAt?: string;
  /** Prior versions, oldest → newest. Active image lives on the item itself. */
  versions?: VisionBoardVersion[];
};

export type VisionSelfReference = {
  /** Guest-only IndexedDB id — never written to cloud. */
  mediaId?: string;
  /** CloudFront URL (required for signed-in sync). */
  url?: string;
  /** S3 object key (required for signed-in sync / generate). */
  key?: string;
  mimeType: string;
  fileName: string;
  width: number;
  height: number;
  /** Bytes of the stored file — informational. */
  byteLength: number;
  updatedAt: string;
};

/** Optional supporting refs (people, pets, places) labeled for the image model. */
export type VisionExtraReference = VisionSelfReference & {
  id: string;
  /** What this image shows — used so generate can match scene text to the right ref. */
  description: string;
};

export type IdeateVisionBoardStoreV1 = {
  v: 1 | 2;
  items: VisionBoardItem[];
  selfReference?: VisionSelfReference | null;
  /** Optional supporting photos (mum, dog, etc.), max 3. */
  extraReferences?: VisionExtraReference[];
};

const LS_KEY = "mm_ideate_vision_board_v1";
export const MAX_VISION_EXTRA_REFERENCES = 3;

/** Signed-in session copy — never written to localStorage. */
let memoryStore: IdeateVisionBoardStoreV1 | null = null;

const SWATCH_COLORS = [
  "#C4A882",
  "#8FA89A",
  "#A8B5C4",
  "#D4A090",
  "#C9B896",
  "#B8A99A",
  "#9AADB5",
] as const;

function emptyBoard(): IdeateVisionBoardStoreV1 {
  return { v: 2, items: [], selfReference: null, extraReferences: [] };
}

function isSignedIn(): boolean {
  return Boolean(getMedimadeSessionJwt());
}

function removeVisionLs(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LS_KEY);
  } catch {
    /* */
  }
}

/** Drop signed-in memory + any leftover localStorage vision board. */
export function clearIdeateVisionBoardDeviceData(): void {
  memoryStore = null;
  removeVisionLs();
}

export function pickVisionSwatchColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * 17) % 997;
  return SWATCH_COLORS[h % SWATCH_COLORS.length]!;
}

export function visionLabelFromPrompt(prompt: string): string {
  const t = prompt.trim();
  if (!t) return "";
  return t.length > 48 ? `${t.slice(0, 45)}…` : t;
}

function newVersionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `vv_${crypto.randomUUID()}`;
  }
  return `vv_${Date.now().toString(16)}`;
}

function normalizeVersion(x: unknown): VisionBoardVersion | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string" || typeof o.prompt !== "string") return null;
  return {
    id: o.id,
    prompt: o.prompt,
    ...(typeof o.imageUrl === "string" ? { imageUrl: o.imageUrl } : {}),
    ...(typeof o.mediaId === "string" ? { mediaId: o.mediaId } : {}),
    ...(typeof o.mediaKey === "string" ? { mediaKey: o.mediaKey } : {}),
    ...(typeof o.changeRequest === "string"
      ? { changeRequest: o.changeRequest }
      : {}),
    createdAt:
      typeof o.createdAt === "string" ? o.createdAt : new Date().toISOString(),
  };
}

function normalizeItem(x: unknown): VisionBoardItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string") return null;
  const kind = o.kind === "image" || o.kind === "swatch" ? o.kind : undefined;
  const versions = Array.isArray(o.versions)
    ? o.versions
        .map(normalizeVersion)
        .filter((v): v is VisionBoardVersion => Boolean(v))
        .slice(-24)
    : undefined;
  return {
    id: o.id,
    color: typeof o.color === "string" ? o.color : "#E5DFD0",
    label: typeof o.label === "string" ? o.label : "",
    ...(kind ? { kind } : {}),
    ...(typeof o.mediaId === "string" ? { mediaId: o.mediaId } : {}),
    ...(typeof o.imageUrl === "string" ? { imageUrl: o.imageUrl } : {}),
    ...(typeof o.mediaKey === "string" ? { mediaKey: o.mediaKey } : {}),
    ...(typeof o.prompt === "string" ? { prompt: o.prompt } : {}),
    ...(typeof o.changeRequest === "string"
      ? { changeRequest: o.changeRequest }
      : {}),
    ...(typeof o.createdAt === "string" ? { createdAt: o.createdAt } : {}),
    ...(versions?.length ? { versions } : {}),
  };
}

function normalizeSelfRef(x: unknown): VisionSelfReference | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.mimeType !== "string") return null;
  const mediaId = typeof o.mediaId === "string" ? o.mediaId : undefined;
  const url = typeof o.url === "string" ? o.url : undefined;
  const key = typeof o.key === "string" ? o.key : undefined;
  if (!mediaId && !url) return null;
  return {
    ...(mediaId ? { mediaId } : {}),
    ...(url ? { url } : {}),
    ...(key ? { key } : {}),
    mimeType: o.mimeType,
    fileName: typeof o.fileName === "string" ? o.fileName : "reference.jpg",
    width: typeof o.width === "number" ? o.width : 0,
    height: typeof o.height === "number" ? o.height : 0,
    byteLength: typeof o.byteLength === "number" ? o.byteLength : 0,
    updatedAt:
      typeof o.updatedAt === "string"
        ? o.updatedAt
        : new Date().toISOString(),
  };
}

function normalizeExtraRef(x: unknown): VisionExtraReference | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string") return null;
  const base = normalizeSelfRef(x);
  if (!base) return null;
  return {
    ...base,
    id: o.id,
    description: typeof o.description === "string" ? o.description : "",
  };
}

function normalizeStore(raw: unknown): IdeateVisionBoardStoreV1 {
  if (!raw || typeof raw !== "object") return emptyBoard();
  const parsed = raw as {
    v?: number;
    items?: unknown[];
    selfReference?: unknown;
    extraReferences?: unknown[];
  };
  if ((parsed?.v !== 1 && parsed?.v !== 2) || !Array.isArray(parsed.items)) {
    return emptyBoard();
  }
  return {
    v: 2,
    items: parsed.items
      .map(normalizeItem)
      .filter((i): i is VisionBoardItem => Boolean(i))
      .slice(0, 48),
    selfReference: normalizeSelfRef(parsed.selfReference),
    extraReferences: Array.isArray(parsed.extraReferences)
      ? parsed.extraReferences
          .map(normalizeExtraRef)
          .filter((r): r is VisionExtraReference => Boolean(r))
          .slice(0, MAX_VISION_EXTRA_REFERENCES)
      : [],
  };
}

export function loadIdeateVisionBoardStore(): IdeateVisionBoardStoreV1 {
  if (typeof window === "undefined") return emptyBoard();
  if (isSignedIn()) {
    return memoryStore ? structuredClone(memoryStore) : emptyBoard();
  }
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return emptyBoard();
    return normalizeStore(JSON.parse(raw));
  } catch {
    return emptyBoard();
  }
}

/**
 * Persist working copy: memory only when signed in (never localStorage);
 * guests use localStorage.
 */
export function saveIdeateVisionBoardStoreLocal(store: IdeateVisionBoardStoreV1) {
  if (typeof window === "undefined") return;
  const normalized: IdeateVisionBoardStoreV1 = {
    v: 2,
    items: store.items.slice(0, 48),
    selfReference: store.selfReference ?? null,
    extraReferences: (store.extraReferences ?? [])
      .slice(0, MAX_VISION_EXTRA_REFERENCES)
      .map((r) => ({
        ...r,
        description: String(r.description || "").slice(0, 280),
      })),
  };
  if (isSignedIn()) {
    memoryStore = structuredClone(normalized);
    removeVisionLs();
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
export function saveIdeateVisionBoardStore(store: IdeateVisionBoardStoreV1) {
  saveIdeateVisionBoardStoreLocal(store);
  if (typeof window !== "undefined" && isSignedIn()) {
    void import("@/lib/ideate-cloud").then((m) => m.scheduleIdeateCloudPush());
  }
}

export function upsertVisionBoardItem(
  store: IdeateVisionBoardStoreV1,
  item: VisionBoardItem,
): IdeateVisionBoardStoreV1 {
  const i = store.items.findIndex((x) => x.id === item.id);
  const items =
    i === -1
      ? [item, ...store.items]
      : store.items.map((x, j) => (j === i ? item : x));
  return { ...store, v: 2, items: items.slice(0, 48) };
}

export function removeVisionBoardItem(
  store: IdeateVisionBoardStoreV1,
  id: string,
): IdeateVisionBoardStoreV1 {
  return {
    ...store,
    v: 2,
    items: store.items.filter((x) => x.id !== id),
  };
}

/** Snapshot the active image onto `versions`, then apply a new active image. */
export function applyVisionBoardRefinement(
  item: VisionBoardItem,
  next: {
    prompt: string;
    imageUrl?: string;
    mediaId?: string;
    mediaKey?: string;
    changeRequest?: string;
  },
): VisionBoardItem {
  const now = new Date().toISOString();
  const prior: VisionBoardVersion[] = [...(item.versions ?? [])];
  if (item.prompt && (item.imageUrl || item.mediaId)) {
    prior.push({
      id: newVersionId(),
      prompt: item.prompt,
      ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
      ...(item.mediaId ? { mediaId: item.mediaId } : {}),
      ...(item.mediaKey ? { mediaKey: item.mediaKey } : {}),
      ...(item.changeRequest ? { changeRequest: item.changeRequest } : {}),
      createdAt: item.createdAt || now,
    });
  }
  return {
    id: item.id,
    color: item.color,
    label: visionLabelFromPrompt(next.prompt),
    kind: "image",
    prompt: next.prompt,
    ...(next.imageUrl ? { imageUrl: next.imageUrl } : {}),
    ...(next.mediaId ? { mediaId: next.mediaId } : {}),
    ...(next.mediaKey ? { mediaKey: next.mediaKey } : {}),
    ...(next.changeRequest ? { changeRequest: next.changeRequest } : {}),
    createdAt: now,
    versions: prior.slice(-24),
  };
}

/** Make a prior version active; current active is pushed onto history. */
export function restoreVisionBoardVersion(
  item: VisionBoardItem,
  versionId: string,
): VisionBoardItem | null {
  const versions = item.versions ?? [];
  const idx = versions.findIndex((v) => v.id === versionId);
  if (idx < 0) return null;
  const chosen = versions[idx]!;
  const now = new Date().toISOString();
  const rest = versions.filter((v) => v.id !== versionId);
  if (item.prompt && (item.imageUrl || item.mediaId)) {
    rest.push({
      id: newVersionId(),
      prompt: item.prompt,
      ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}),
      ...(item.mediaId ? { mediaId: item.mediaId } : {}),
      ...(item.mediaKey ? { mediaKey: item.mediaKey } : {}),
      ...(item.changeRequest ? { changeRequest: item.changeRequest } : {}),
      createdAt: item.createdAt || now,
    });
  }
  return {
    ...item,
    prompt: chosen.prompt,
    label: visionLabelFromPrompt(chosen.prompt),
    kind: "image",
    imageUrl: chosen.imageUrl,
    mediaId: chosen.mediaId,
    mediaKey: chosen.mediaKey,
    changeRequest: chosen.changeRequest,
    createdAt: chosen.createdAt || now,
    versions: rest.slice(-24),
  };
}
