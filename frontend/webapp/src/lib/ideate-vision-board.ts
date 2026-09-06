/**
 * Ideate vision board — metadata cache; binaries in IndexedDB / CloudFront URLs.
 * Signed-in writes also schedule cloud PUT via ideate-cloud.
 */

import { getMedimadeSessionJwt } from "@/lib/auth-session";

export type VisionBoardItem = {
  id: string;
  /** Soft fill for the preview mosaic (and fallback when no image). */
  color: string;
  label: string;
  kind?: "swatch" | "image";
  /** IndexedDB media id for generated / uploaded board tiles. */
  mediaId?: string;
  /** CloudFront URL when uploaded / generated server-side. */
  imageUrl?: string;
  mediaKey?: string;
  /** Scene prompt used to generate this tile (if any). */
  prompt?: string;
  createdAt?: string;
};

export type VisionSelfReference = {
  mediaId: string;
  mimeType: string;
  fileName: string;
  width: number;
  height: number;
  /** Bytes of the stored (full-res) file — informational. */
  byteLength: number;
  updatedAt: string;
};

export type IdeateVisionBoardStoreV1 = {
  v: 1 | 2;
  items: VisionBoardItem[];
  selfReference?: VisionSelfReference | null;
};

const LS_KEY = "mm_ideate_vision_board_v1";

const SWATCH_COLORS = [
  "#C4A882",
  "#8FA89A",
  "#A8B5C4",
  "#D4A090",
  "#C9B896",
  "#B8A99A",
  "#9AADB5",
] as const;

export function pickVisionSwatchColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i) * 17) % 997;
  return SWATCH_COLORS[h % SWATCH_COLORS.length]!;
}

function normalizeItem(x: unknown): VisionBoardItem | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.id !== "string") return null;
  const kind = o.kind === "image" || o.kind === "swatch" ? o.kind : undefined;
  return {
    id: o.id,
    color: typeof o.color === "string" ? o.color : "#E5DFD0",
    label: typeof o.label === "string" ? o.label : "",
    ...(kind ? { kind } : {}),
    ...(typeof o.mediaId === "string" ? { mediaId: o.mediaId } : {}),
    ...(typeof o.imageUrl === "string" ? { imageUrl: o.imageUrl } : {}),
    ...(typeof o.mediaKey === "string" ? { mediaKey: o.mediaKey } : {}),
    ...(typeof o.prompt === "string" ? { prompt: o.prompt } : {}),
    ...(typeof o.createdAt === "string" ? { createdAt: o.createdAt } : {}),
  };
}

function normalizeSelfRef(x: unknown): VisionSelfReference | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.mediaId !== "string" || typeof o.mimeType !== "string") {
    return null;
  }
  return {
    mediaId: o.mediaId,
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

export function loadIdeateVisionBoardStore(): IdeateVisionBoardStoreV1 {
  if (typeof window === "undefined") {
    return { v: 2, items: [], selfReference: null };
  }
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return { v: 2, items: [], selfReference: null };
    const parsed = JSON.parse(raw) as {
      v?: number;
      items?: unknown[];
      selfReference?: unknown;
    };
    if ((parsed?.v !== 1 && parsed?.v !== 2) || !Array.isArray(parsed.items)) {
      return { v: 2, items: [], selfReference: null };
    }
    return {
      v: 2,
      items: parsed.items
        .map(normalizeItem)
        .filter((i): i is VisionBoardItem => Boolean(i))
        .slice(0, 48),
      selfReference: normalizeSelfRef(parsed.selfReference),
    };
  } catch {
    return { v: 2, items: [], selfReference: null };
  }
}

export function saveIdeateVisionBoardStore(store: IdeateVisionBoardStoreV1) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LS_KEY,
      JSON.stringify({
        v: 2,
        items: store.items.slice(0, 48),
        selfReference: store.selfReference ?? null,
      } satisfies IdeateVisionBoardStoreV1),
    );
  } catch {
    /* ignore */
  }
  if (getMedimadeSessionJwt()) {
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
